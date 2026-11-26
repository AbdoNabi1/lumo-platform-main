import { useCallback, useState } from "react";
import { saveNotificationSettingsAction } from "@/app/settings/notifications/actions";
import type {
  NotificationSettingsPatch,
  NotificationSettingsSnapshot,
} from "@/lib/notification-settings-model";

export interface SettingsSaver {
  readonly pending: boolean;
  /** The refusal from the last save, or null. */
  readonly error: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
  /** Saves one part of the document with the version this page loaded; true when it was saved. */
  readonly save: (patch: NotificationSettingsPatch) => Promise<boolean>;
}

const NO_ERRORS: Readonly<Record<string, string>> = {};

/**
 * One save at a time for the shared notification-settings document. The server merges the patch into
 * the current document and checks the version the page loaded, so a page that is out of date gets a
 * 409 message instead of overwriting someone else's save.
 */
export function useSettingsSave(
  document: NotificationSettingsSnapshot,
  onSaved: (settings: NotificationSettingsSnapshot) => void,
  /** Shown when the call itself fails (the network, a crashed action). */
  failedMessage: string,
): SettingsSaver {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState(NO_ERRORS);
  const version = document.version;

  const save = useCallback(
    async (patch: NotificationSettingsPatch): Promise<boolean> => {
      setPending(true);
      setError(null);
      setFieldErrors(NO_ERRORS);
      try {
        const result = await saveNotificationSettingsAction({ expectedVersion: version, patch });
        if (result.status === "success") {
          onSaved(result.settings);
          return true;
        }
        setError(result.message);
        setFieldErrors(result.fieldErrors);
        return false;
      } catch {
        setError(failedMessage);
        return false;
      } finally {
        setPending(false);
      }
    },
    [version, onSaved, failedMessage],
  );

  return { pending, error, fieldErrors, save };
}
