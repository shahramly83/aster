// App-wide prompts, so nothing has to reach for Alert.alert.
//
// Alert.alert renders an OS dialog: system type, system buttons, no icon, and on
// Android a look that shifts with the manufacturer's skin. "Couldn't share link"
// arrived in the same grey box as a permissions prompt from the operating
// system, so nothing Aster said sounded like Aster. The app already had a
// branded ConfirmDialog, but only three screens held the state to use it; every
// other prompt fell back to the native one.
//
// This renders that same ConfirmDialog from the root and hands out a promise API,
// so a call site stays as short as the Alert it replaces:
//
//   const dialog = useDialog();
//   await dialog.alert({ title: "Link shared", message: "…" });
//   if (await dialog.confirm({ title: "Reschedule?", variant: "danger" })) { … }
//
// confirm() resolves true/false, so the caller reads top to bottom instead of
// splitting across an onPress callback.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef(null);

  const settle = useCallback((result) => {
    setState(null);
    setBusy(false);
    const r = resolver.current;
    resolver.current = null;
    r?.(result);
  }, []);

  const open = useCallback((opts) => new Promise((resolve) => {
    // A second prompt raised while one is open would strand the first promise.
    // Resolve it as dismissed rather than leave a caller awaiting forever.
    resolver.current?.(false);
    resolver.current = resolve;
    setState(opts);
  }), []);

  const api = useMemo(() => ({
    alert: (opts) => open({ ...opts, alertOnly: true }),
    confirm: (opts) => open({ ...opts, alertOnly: false }),
  }), [open]);

  const accept = async () => {
    // A caller can pass onConfirm to keep the dialog up while its work runs, so
    // the spinner sits on the button that started it.
    if (state?.onConfirm) {
      setBusy(true);
      try { await state.onConfirm(); } finally { setBusy(false); }
    }
    settle(true);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      <ConfirmDialog
        visible={!!state}
        title={state?.title}
        message={state?.message}
        detail={state?.detail}
        icon={state?.icon}
        variant={state?.variant}
        confirmLabel={state?.confirmLabel}
        cancelLabel={state?.cancelLabel}
        alertOnly={state?.alertOnly}
        busy={busy}
        onConfirm={accept}
        onCancel={() => settle(false)}
      />
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider>");
  return ctx;
}
