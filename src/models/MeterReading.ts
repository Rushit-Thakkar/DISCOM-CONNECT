import mongoose, { Document, Schema } from 'mongoose';

export interface ILocation {
  type: 'Point';
  coordinates: [number, number];
  address: string;
}

export interface IMeterReading extends Document {
  user: mongoose.Types.ObjectId;
  meterNumber: string;
  reading: number;
  unit: 'kWh' | 'units';
  photo: string;
  location: ILocation;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
  readerNotes?: string;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
}

const MeterReadingSchema: Schema = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Please add a user'],
    },
    meterNumber: {
      type: String,
      required: [true, 'Please add a meter number'],
      trim: true,
      maxlength: [50, 'Meter number cannot be more than 50 characters'],
    },
    reading: {
      type: Number,
      required: [true, 'Please add a meter reading'],
      min: [0, 'Reading must be a positive number'],
    },
    unit: {
      type: String,
      enum: ['kWh', 'units'],
      default: 'units',
    },
    photo: {
      type: String,
      required: [true, 'Please add a photo of the meter'],
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: [true, 'Please add coordinates'],
        index: '2dsphere',
      },
      address: {
        type: String,
        required: [true, 'Please add an address'],
      },
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot be more than 500 characters'],
    },
    readerNotes: {
      type: String,
      maxlength: [500, 'Reader notes cannot be more than 500 characters'],
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Create geospatial index for location-based queries
MeterReadingSchema.index({ location: '2dsphere' });

// Reverse populate with virtuals
MeterReadingSchema.virtual('reader', {
  ref: 'User',
  localField: 'user',
  foreignField: '_id',
  justOne: true,
});

export default mongoose.model<IMeterReading>('MeterReading', MeterReadingSchema);
