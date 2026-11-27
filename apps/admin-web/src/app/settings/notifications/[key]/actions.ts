"use server";

import {
  currentDictionary,
  parseDraft,
  parseRef,
  previewTemplate,
  revertTemplate,
  saveTemplate,
  sendTest,
} from "@/lib/notification-settings-actions";
import type {
  PreviewActionResult,
  TemplateActionResult,
  TestEmailActionResult,
} from "@/lib/notification-settings-model";

/** Saves the merchant's own subject and message for one template and language. */
export async function saveTemplateAction(input: unknown): Promise<TemplateActionResult> {
  return saveTemplate(parseDraft(input), await currentDictionary());
}

/** "Revert to default": deletes the merchant's copy for that language. */
export async function revertTemplateAction(input: unknown): Promise<TemplateActionResult> {
  return revertTemplate(parseRef(input), await currentDictionary());
}

/** Renders the draft with sample data. */
export async function previewTemplateAction(input: unknown): Promise<PreviewActionResult> {
  return previewTemplate(parseDraft(input), await currentDictionary());
}

/** "Send test to me": the draft goes to the signed-in member's own address, never one from the request. */
export async function sendTestEmailAction(input: unknown): Promise<TestEmailActionResult> {
  return sendTest(parseDraft(input), await currentDictionary());
}
