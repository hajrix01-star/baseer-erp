import { administrationText } from "./administration-copy";

export type UserAvatarKind = "INITIALS" | "MALE" | "FEMALE";

export function AdministrationUserAvatar({
  name,
  kind,
  large = false,
  language = "ar",
}: {
  name: string;
  kind: UserAvatarKind;
  large?: boolean;
  language?: "ar" | "en";
}) {
  const text = administrationText(language);
  const initial = Array.from(name.trim())[0] ?? "؟";
  const visual = kind === "MALE" ? "👨" : kind === "FEMALE" ? "👩" : initial;
  const label = kind === "MALE" ? text.avatarMale : kind === "FEMALE" ? text.avatarFemale : text.avatarNamed(name);
  return <span className={`administration-user-avatar administration-user-avatar--${kind.toLowerCase()}${large ? " is-large" : ""}`} role="img" aria-label={label}>{visual}</span>;
}