import { Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import MeterReading, { IMeterReading } from '../models/MeterReading';
import { AuthRequest } from '../middleware/auth.middleware';
import ErrorResponse from '../utils/errorResponse';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: 'user' | 'admin';
      };
    }
  }
}

// Extend the Express Request type to include files
interface FileRequest extends AuthRequest {
  files?: {
    file: {
      name: string;
      mimetype: string;
      size: number;
      mv: (path: string) => Promise<void>;
      data: Buffer;
    };
  };
}

// Simple geocoder mock (replace with actual geocoding service)
const geocoder = {
  geocode: async (zipcode: string) => {
    // In a real app, this would call a geocoding API
    return [{
      latitude: 0,
      longitude: 0,
      formattedAddress: `${zipcode}, Unknown Location`
    }];
  }
};

// @desc    Get all meter readings
// @route   GET /api/meters
// @access  Private/Admin
export const getMeterReadings = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const query: any = {};
    
    // Filter by status if provided
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    // If user is not admin, only show their readings
    if (req.user.role === 'user') {
      query.user = req.user.id;
    }

    const total = await MeterReading.countDocuments(query);
    const meterReadings = await MeterReading.find(query)
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: meterReadings.length,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total
      },
      data: meterReadings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single meter reading
// @route   GET /api/meters/:id
// @access  Private
export const getMeterReading = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meterReading = await MeterReading.findById(req.params.id).populate('user', 'name email');

    if (!meterReading) {
      return next(new ErrorResponse(`Meter reading not found with id of ${req.params.id}`, 404));
    }

    // Make sure user is the owner or admin
    if (meterReading.user._id.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(
        new ErrorResponse(
          `User ${req.user.id} is not authorized to access this meter reading`,
          401
        )
      );
    }

    res.status(200).json({
      success: true,
      data: meterReading
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new meter reading
// @route   POST /api/meters
// @access  Private
export const createMeterReading = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Add user to req.body
    req.body.user = req.user.id;

    // Check for validation errors
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorResponse('Validation failed', 400));
    }

    // Check for existing pending reading for this meter
    const existingReading = await MeterReading.findOne({
      meterNumber: req.body.meterNumber,
      status: 'pending'
    });

    if (existingReading) {
      return next(
        new ErrorResponse(
          `There is already a pending reading for meter ${req.body.meterNumber}`,
          400
        )
      );
    }

    // Create reading
    const meterReading = await MeterReading.create(req.body);

    res.status(201).json({
      success: true,
      data: meterReading
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update meter reading
// @route   PUT /api/meters/:id
// @access  Private
export const updateMeterReading = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let meterReading = await MeterReading.findById(req.params.id);

    if (!meterReading) {
      return next(
        new ErrorResponse(`Meter reading not found with id of ${req.params.id}`, 404)
      );
    }

    // Make sure user is the owner or admin
    if (meterReading.user.toString() !== req.user?.id && req.user?.role !== 'admin') {
      return next(
        new ErrorResponse(
          `User ${req.user.id} is not authorized to update this meter reading`,
          401
        )
      );
    }

    // If admin is updating status, add approvedBy and approvedAt
    if (req.body.status && req.user?.role === 'admin') {
      req.body.approvedBy = req.user.id;
      req.body.approvedAt = new Date();
    }

    meterReading = await MeterReading.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: meterReading
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete meter reading
// @route   DELETE /api/meters/:id
// @access  Private
export const deleteMeterReading = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meterReading = await MeterReading.findById(req.params.id);

    if (!meterReading) {
      return next(
        new ErrorResponse(`Meter reading not found with id of ${req.params.id}`, 404)
      );
    }

    // Make sure user is the owner or admin
    if (meterReading.user.toString() !== req.user?.id && req.user?.role !== 'admin') {
      return next(
        new ErrorResponse(
          `User ${req.user.id} is not authorized to delete this meter reading`,
          401
        )
      );
    }

    // Delete photo file if it exists
    if (meterReading.photo) {
      const filePath = path.join(__dirname, `../public/uploads/${meterReading.photo}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await MeterReading.deleteOne({ _id: meterReading._id });

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get readings within a radius
// @route   GET /api/meters/radius/:zipcode/:distance
// @access  Private/Admin
export const getReadingsInRadius = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { zipcode, distance } = req.params;

    // Get lat/lng from geocoder
    const loc = await geocoder.geocode(zipcode);
    const lat = loc[0].latitude;
    const lng = loc[0].longitude;

    // Calc radius using radians
    // Divide dist by radius of Earth
    // Earth Radius = 3,963 mi / 6,378 km
    const radius = parseInt(distance) / 3963;

    const readings = await MeterReading.find({
      location: {
        $geoWithin: { $centerSphere: [[lng, lat], radius] }
      }
    });

    res.status(200).json({
      success: true,
      count: readings.length,
      data: readings
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload photo for meter reading
// @route   PUT /api/meters/:id/photo
// @access  Private
export const meterReadingPhotoUpload = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const meterReading = await MeterReading.findById(req.params.id);

    if (!meterReading) {
      return next(
        new ErrorResponse(`Meter reading not found with id of ${req.params.id}`, 404)
      );
    }

    // Make sure user is the owner or admin
    if (meterReading.user.toString() !== req.user?.id && req.user?.role !== 'admin') {
      return next(
        new ErrorResponse(
          `User ${req.user.id} is not authorized to update this meter reading`,
          401
        )
      return next(new ErrorResponse(`Please upload a file`, 400));
    }

    const file = req.files.file;

    // Make sure the image is a photo
    if (!file.mimetype.startsWith('image')) {
      return next(new ErrorResponse(`Please upload an image file`, 400));
    }
    // Check file size
    const maxSize = process.env.MAX_FILE_UPLOAD ? parseInt(process.env.MAX_FILE_UPLOAD) * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return next(
        new ErrorResponse(
          `Please upload an image less than ${process.env.MAX_FILE_UPLOAD || 10}MB`,
          400
        )
      );
    }

    // Create custom filename
    file.name = `photo_${meterReading._id}${path.parse(file.name).ext}`;

    const uploadPath = path.join(__dirname, '../../uploads', file.name);
    
    // Create a write stream
    const fileStream = fs.createWriteStream(uploadPath);
    const readable = new Readable();
    readable.push(file.data);
    readable.push(null);
    
    try {
      // Pipe the file data to the file system
      await new Promise((resolve, reject) => {
        readable.pipe(fileStream)
          .on('finish', resolve)
          .on('error', reject);
      });

      await MeterReading.findByIdAndUpdate(req.params.id, { photo: file.name });

      res.status(200).json({
        success: true,
        data: file.name
      });
    } catch (err) {
      console.error(err);
      return next(new ErrorResponse(`Problem with file upload`, 500));
    }
      if (err) {
        console.error(err);
        return next(new ErrorResponse(`Problem with file upload`, 500));
      }

      await MeterReading.findByIdAndUpdate(req.params.id, { photo: file.name });

      res.status(200).json({
        success: true,
        data: file.name
      });
    });
  } catch (error) {
    next(error);
  }
};
