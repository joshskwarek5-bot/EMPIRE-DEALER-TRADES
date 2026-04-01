import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trades: defineTable({
    tradeDate: v.string(),
    manager: v.string(),
    oursTheirs: v.string(),
    sellingCA: v.string(),
    dealerName: v.string(),
    dealerContact: v.string(),
    dealerCode: v.string(),
    // Outgoing vehicle
    outStock: v.string(),
    outYear: v.string(),
    outModel: v.string(),
    outTrim: v.string(),
    outColor: v.string(),
    outVIN: v.string(),
    outInvoice: v.string(),
    outHoldback: v.string(),
    outCollectionsHoldback: v.optional(v.string()),
    outHasCollections: v.optional(v.boolean()),
    outAccessories: v.string(),
    // Incoming vehicle
    inStock: v.string(),
    inYear: v.string(),
    inModel: v.string(),
    inTrim: v.string(),
    inColor: v.string(),
    inVIN: v.string(),
    inInvoice: v.string(),
    inHoldback: v.string(),
    inCollectionsHoldback: v.optional(v.string()),
    inHasCollections: v.optional(v.boolean()),
    inAccessories: v.string(),
    notes: v.string(),
    // Uploaded invoice PDF storage IDs
    outInvoiceStorageId: v.optional(v.id("_storage")),
    inInvoiceStorageId: v.optional(v.id("_storage")),
  }),
});
