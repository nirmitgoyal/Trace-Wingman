import mongoose, { Schema, Document } from "mongoose";

export type Role = "PATIENT" | "CAREGIVER";

export interface IUser extends Document {
  phone: string;
  role: Role;
  name?: string;
  village?: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    phone: { type: String, required: true, unique: true },
    role: { type: String, required: true, enum: ["PATIENT", "CAREGIVER"] },
    name: { type: String },
    village: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
