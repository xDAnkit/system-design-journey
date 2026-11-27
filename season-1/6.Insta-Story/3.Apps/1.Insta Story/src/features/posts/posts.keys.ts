// Redis key names for everything about a post or a viewer. One place, so the writers and the readers cannot drift apart.
export const likesKey = (postId: string): string => `post:${postId}:likes`;
export const commentsKey = (postId: string): string => `post:${postId}:comments`;
export const viewsKey = (postId: string): string => `post:${postId}:views`; // total views, plain counter
export const uniqueViewsKey = (postId: string): string => `post:${postId}:uv`; // unique views, HyperLogLog
export const likedFilterKey = (userId: string): string => `user:${userId}:liked`; // Cuckoo: posts this user liked
export const seenFilterKey = (userId: string): string => `user:${userId}:seen`; // Cuckoo: posts this user opened
