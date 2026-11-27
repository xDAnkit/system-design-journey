import "../bootstrap/mongo-host-dns.js";
import { connectDatabase, disconnectDatabase } from "../bootstrap/database.js";
import { logger } from "../bootstrap/logger.js";
import { Profile } from "../features/profiles/profiles.model.js";
import { Post } from "../features/posts/posts.model.js";
import { Comment } from "../features/comments/comments.model.js";

// Demo data only. Insert-only: a profile that already has posts is skipped, nothing is deleted or overwritten.
// Images are placeholders from picsum.photos (same seed text = same picture).
const PROFILES = [
  { username: "virat.kohli", displayName: "Virat Kohli", bio: "Carpediem!", verified: true },
  { username: "aarav.sharma", displayName: "Aarav Sharma", bio: "Cricket, chai and code.", verified: true },
  { username: "ananya.iyer", displayName: "Ananya Iyer", bio: "Bharatanatyam dancer. Chennai.", verified: true },
  { username: "rohan.mehta", displayName: "Rohan Mehta", bio: "Street photography. Mumbai.", verified: false },
  { username: "priya.nair", displayName: "Priya Nair", bio: "Travel, trails and filter coffee.", verified: false },
  { username: "kabir.malhotra", displayName: "Kabir Malhotra", bio: "Fitness coach. Delhi.", verified: false },
  { username: "isha.kapoor", displayName: "Isha Kapoor", bio: "Home chef. New recipe every Sunday.", verified: false },
  { username: "arjun.verma", displayName: "Arjun Verma", bio: "Football, always.", verified: false },
  { username: "meera.joshi", displayName: "Meera Joshi", bio: "Illustrator. Pune.", verified: false },
  { username: "vikram.rao", displayName: "Vikram Rao", bio: "Startups and sunrises. Bengaluru.", verified: true },
  { username: "sneha.patil", displayName: "Sneha Patil", bio: "Yoga and slow mornings.", verified: false },
  { username: "dev.khanna", displayName: "Dev Khanna", bio: "Guitarist. Indie sets in Goa.", verified: false },
  // first seed run, kept so their posts and comments stay valid
  { username: "demo.traveller", displayName: "Demo Traveller", bio: "Chasing sunsets", verified: true },
  { username: "demo.foodie", displayName: "Demo Foodie", bio: "Eat. Repeat.", verified: false },
];
const POSTS_PER_PROFILE = 24;
const REELS_PER_PROFILE = 12;
const CAPTIONS = ["Welcome, the stage is ours.", "Sunday vibes", "Back to work", "Golden hour", "No filter needed", "Big day today", "Grateful", "Match day"];
const COMMENTS = ["Amazing!", "Love this", "Legend", "So good", "Wow", "Superb", "Best one yet", "Can't stop watching", "Goals", "Well played"];
const COMMENTERS = ["fan.one", "fan.two", "fan.three", "just.a.viewer", "random.user"];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const between = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
const avatar = (name: string): string => `https://picsum.photos/seed/${name}-avatar/200/200`;

const seedProfile = async (p: (typeof PROFILES)[number]): Promise<void> => {
  await Profile.updateOne({ username: p.username }, { $setOnInsert: { ...p, avatarUrl: avatar(p.username) } }, { upsert: true });

  if ((await Post.countDocuments({ authorId: p.username })) > 0) {
    logger.info(`${p.username}: already has posts, skipped`);
    return;
  }

  // reels are spread through the grid: every 3rd item is a reel until they run out
  const total = POSTS_PER_PROFILE + REELS_PER_PROFILE;
  let reelsLeft = REELS_PER_PROFILE;
  const docs = Array.from({ length: total }, (_, i) => {
    const isReel = reelsLeft > 0 && (i % 3 === 2 || total - i <= reelsLeft);
    if (isReel) reelsLeft--;
    return {
      authorId: p.username,
      type: isReel ? ("reel" as const) : ("post" as const),
      caption: pick(CAPTIONS),
      mediaUrl: `https://picsum.photos/seed/${p.username}-${i}/800/${isReel ? 1200 : 800}`,
    };
  });
  // insertMany keeps array order, so _id grows with the index (newest = last)
  const posts = await Post.insertMany(docs);

  const commenters = [...PROFILES.map((x) => x.username), ...COMMENTERS];
  const comments = posts.flatMap((post) =>
    Array.from({ length: between(3, 8) }, () => ({ postId: post._id, authorId: pick(commenters), text: pick(COMMENTS) })),
  );
  await Comment.insertMany(comments);
  logger.info(`${p.username}: ${posts.length} posts and reels, ${comments.length} comments`);
};

const main = async (): Promise<void> => {
  try {
    await connectDatabase();
    // The app sets bufferCommands=false, so Mongoose's own auto-index at model load runs before the
    // connection is ready and silently builds nothing. createIndexes only adds missing ones, never drops.
    await Promise.all([Profile.createIndexes(), Post.createIndexes(), Comment.createIndexes()]);
    for (const p of PROFILES) await seedProfile(p);
    await disconnectDatabase();
    logger.info("Done.");
    process.exit(0);
  } catch (err) {
    logger.error(`Seed failed: ${(err as Error).stack ?? (err as Error).message}`);
    process.exit(1);
  }
};

await main();
