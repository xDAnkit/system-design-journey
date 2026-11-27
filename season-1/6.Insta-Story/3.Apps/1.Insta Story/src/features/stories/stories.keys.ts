// Redis key names for everything about a story. One place, so readers and writers cannot drift.
export const storyMetaKey = (storyId: string): string =>
  `story:${storyId}:meta`; // JSON, EXAT at expiry
export const storyTombstoneKey = (storyId: string): string =>
  `story:${storyId}:tombstone`; // deleted marker
export const storyViewsKey = (storyId: string): string =>
  `story:${storyId}:views`; // total opens
export const storyUvKey = (storyId: string): string => `story:${storyId}:uv`; // unique viewers, HyperLogLog
export const trayKey = (username: string): string => `tray:${username}`; // followee list, not the stories
export const seenStoryKey = (username: string): string =>
  `user:${username}:seenStory`; // Cuckoo: stories opened
export const storyLikesKey = (storyId: string): string =>
  `story:${storyId}:likes`;
export const storySharesKey = (storyId: string): string =>
  `story:${storyId}:shares`;
export const storyLikedFilterKey = (username: string): string =>
  `user:${username}:likedStory`; // Cuckoo
export const storyViewersKey = (storyId: string): string =>
  `story:${storyId}:viewers`; // first viewer page, 300s
