import { createToaster } from "@ark-ui/solid/toast";
import { AUTO_DISMISS_MS, EXIT_DURATION_MS } from "../constants/timings";

export const toaster = createToaster({
  placement: "bottom",
  duration: AUTO_DISMISS_MS,
  removeDelay: EXIT_DURATION_MS,
  max: 5,
  overlap: false,
  offsets: "1rem",
});

/** Show a brief error toast. */
export function showErrorToast(title: string, description?: string): void {
  toaster.create({
    title,
    description,
    type: "error",
  });
}
