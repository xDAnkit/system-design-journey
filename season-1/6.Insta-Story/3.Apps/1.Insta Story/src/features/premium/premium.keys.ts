// One key per username. Kept short so a profile read costs one small GET.
export const premiumKey = (username: string): string => `premium:${username}`;
