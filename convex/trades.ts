import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("trades").order("desc").collect();
  },
});

export const create = mutation({
  args: {
    tradeDate: v.string(),
    manager: v.string(),
    oursTheirs: v.string(),
    sellingCA: v.string(),
    dealerName: v.string(),
    dealerContact: v.string(),
    dealerCode: v.string(),
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
    outInvoiceStorageId: v.optional(v.id("_storage")),
    inInvoiceStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("trades", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("trades"),
    tradeDate: v.string(),
    manager: v.string(),
    oursTheirs: v.string(),
    sellingCA: v.string(),
    dealerName: v.string(),
    dealerContact: v.string(),
    dealerCode: v.string(),
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
    outInvoiceStorageId: v.optional(v.id("_storage")),
    inInvoiceStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { id, ...fields }) => {
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("trades") },
  handler: async (ctx, { id }) => {
    const trade = await ctx.db.get(id);
    if (trade?.outInvoiceStorageId) {
      await ctx.storage.delete(trade.outInvoiceStorageId);
    }
    if (trade?.inInvoiceStorageId) {
      await ctx.storage.delete(trade.inInvoiceStorageId);
    }
    await ctx.db.delete(id);
  },
});
