import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true })
  name: string;

  @Prop({ default: false })
  isVerified: boolean;

  @Prop({ default: false })
  twoFactorEnabled: boolean;

  @Prop()
  twoFactorSecret: string;

  @Prop({ 
    type: String, 
    enum: ['pending', 'verified', 'rejected', 'not_submitted'],
    default: 'not_submitted'
  })
  kycStatus: string;

  @Prop({
    type: {
      dailyWithdrawal: { type: Number, default: 1000 },
      dailyTrade: { type: Number, default: 10000 },
      maxLeverage: { type: Number, default: 10 }
    },
    default: {}
  })
  tradingLimits: Record<string, any>;

  @Prop()
  lastLogin: Date;

  @Prop({ default: 0 })
  loginAttempts: number;

  @Prop()
  lockUntil: Date;

  @Prop([String])
  ipWhitelist: string[];

  @Prop([{
    deviceId: String,
    userAgent: String,
    lastUsed: Date,
    ipAddress: String
  }])
  devices: Record<string, any>[];
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
UserSchema.index({ email: 1 });
UserSchema.index({ kycStatus: 1 });
UserSchema.index({ createdAt: 1 });