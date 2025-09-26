import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export enum OrderType {
  LIMIT = 'limit',
  MARKET = 'market',
  STOP_LIMIT = 'stop_limit',
  STOP_MARKET = 'stop_market',
  CONDITIONAL = 'conditional',
  SMART = 'smart'
}

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell'
}

export enum OrderStatus {
  OPEN = 'open',
  PARTIALLY_FILLED = 'partially_filled',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected'
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true, unique: true, index: true })
  orderId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, uppercase: true, index: true })
  symbol: string;

  @Prop({ type: String, enum: OrderType, required: true })
  type: OrderType;

  @Prop({ type: String, enum: OrderSide, required: true })
  side: OrderSide;

  @Prop({ required: true, min: 0 })
  quantity: number;

  @Prop({ min: 0 })
  price: number;

  @Prop({ min: 0 })
  stopPrice: number;

  @Prop({ default: 0, min: 0 })
  filledQuantity: number;

  @Prop({ default: 0, min: 0 })
  averageFillPrice: number;

  @Prop({ type: String, enum: OrderStatus, default: OrderStatus.OPEN })
  status: OrderStatus;

  @Prop({ type: String, enum: ['GTC', 'IOC', 'FOK'], default: 'GTC' })
  timeInForce: string;

  @Prop({ default: 1, min: 1, max: 100 })
  leverage: number;

  @Prop({ default: false })
  reduceOnly: boolean;

  @Prop({ default: false })
  postOnly: boolean;

  @Prop({ index: true })
  clientOrderId: string;

  @Prop({ default: false })
  isDarkPool: boolean;

  @Prop()
  condition: {
    type: string;
    value: number;
    trigger: 'last_price' | 'mark_price';
  };

  @Prop()
  smartRouting: {
    enabled: boolean;
    strategies: string[];
  };
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Virtual for remaining quantity
OrderSchema.virtual('remainingQuantity').get(function() {
  return this.quantity - this.filledQuantity;
});

// Indexes for efficient querying
OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ symbol: 1, status: 1 });
OrderSchema.index({ createdAt: 1 });
OrderSchema.index({ isDarkPool: 1, status: 1 });