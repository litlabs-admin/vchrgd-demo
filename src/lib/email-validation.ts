const COMMON_BAD_TLDS = new Set([
  "cmo",
  "co,",
  "con",
  "comm",
  "ocm",
]);

export function normaliseEmailInput(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function getEmailValidationMessage(value: string | null | undefined) {
  const email = normaliseEmailInput(value);

  if (!email) {
    return "Enter an email address.";
  }

  if (email.length > 254 || /\s/.test(email)) {
    return "Enter a valid email address.";
  }

  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return "Enter a valid email address.";
  }

  const [localPart, domain] = parts;
  if (
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
  ) {
    return "Enter a valid email address.";
  }

  const labels = domain.split(".");
  const tld = labels.at(-1) ?? "";
  if (
    labels.length < 2 ||
    labels.some((label) => !label || label.startsWith("-") || label.endsWith("-")) ||
    !labels.every((label) => /^[a-z0-9-]+$/i.test(label)) ||
    !/^[a-z]{2,24}$/i.test(tld)
  ) {
    return "Enter a valid email domain, for example name@example.com.";
  }

  if (COMMON_BAD_TLDS.has(tld.toLowerCase())) {
    return `Check the email ending. Did you mean .com rather than .${tld}?`;
  }

  return "";
}

export function isValidEmailAddress(value: string | null | undefined) {
  return !getEmailValidationMessage(value);
}

export function normaliseUkMobileInput(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  const compact = trimmed.replace(/[\s().-]+/g, "");

  if (compact.startsWith("+44")) {
    return `0${compact.slice(3)}`;
  }

  if (compact.startsWith("44")) {
    return `0${compact.slice(2)}`;
  }

  return compact;
}

export function getUkMobileValidationMessage(value: string | null | undefined) {
  const mobile = normaliseUkMobileInput(value);

  if (!mobile) {
    return "Enter a UK mobile number.";
  }

  if (!/^\d+$/.test(mobile)) {
    return "Enter a UK mobile number using digits only.";
  }

  if (!mobile.startsWith("07")) {
    return "Enter a UK mobile number beginning 07.";
  }

  if (mobile.length !== 11) {
    return "Enter an 11 digit UK mobile number.";
  }

  return "";
}

export function isValidUkMobileNumber(value: string | null | undefined) {
  return !getUkMobileValidationMessage(value);
}
