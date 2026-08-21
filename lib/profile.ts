export const PROFILE_AVATARS = ["🐪", "🦊", "🦁", "🐯", "🐉", "🦚", "🦅", "🐺"] as const;
export type ProfileAvatar = typeof PROFILE_AVATARS[number];
export const DEFAULT_PROFILE_AVATAR: ProfileAvatar = PROFILE_AVATARS[0];

export function isProfileAvatar(value: unknown): value is ProfileAvatar {
  return typeof value === "string" && (PROFILE_AVATARS as readonly string[]).includes(value);
}
