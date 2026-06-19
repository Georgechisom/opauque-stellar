/**
 * Schema field primitives shared by the schema codec and the schema service.
 */

export type FieldType =
  | "bool"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "string"
  | "pubkey";

export interface FieldDef {
  /** Stable ordinal id (index in declaration order). */
  id: string;
  name: string;
  type: FieldType;
}
