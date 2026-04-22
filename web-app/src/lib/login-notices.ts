const LOGIN_NOTICE_KEY = "post-login-notice";

export function rememberLoginNotice(message: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LOGIN_NOTICE_KEY, message);
}

export function readLoginNotice() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(LOGIN_NOTICE_KEY) || "";
}

export function clearLoginNotice() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(LOGIN_NOTICE_KEY);
}
