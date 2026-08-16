export type UserAvatarKind = "INITIALS" | "MALE" | "FEMALE";

export function AdministrationUserAvatar({
  name,
  kind,
  large = false,
}: {
  name: string;
  kind: UserAvatarKind;
  large?: boolean;
}) {
  const initial = Array.from(name.trim())[0] ?? "؟";
  const visual = kind === "MALE" ? "👨" : kind === "FEMALE" ? "👩" : initial;
  const label =
    kind === "MALE"
      ? "صورة رمزية: رجل"
      : kind === "FEMALE"
        ? "صورة رمزية: امرأة"
        : `صورة رمزية: ${name}`;
  return (
    <span
      className={`administration-user-avatar administration-user-avatar--${kind.toLowerCase()}${large ? " is-large" : ""}`}
      role="img"
      aria-label={label}
    >
      {visual}
    </span>
  );
}
