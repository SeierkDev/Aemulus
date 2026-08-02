import path from "node:path";

/**
 * Root of stored recordings.
 *
 * Its own module so the receipt hash and the screenshot archiver can both
 * import it without importing each other. Two definitions would be worse than
 * an import cycle: the hash a receipt commits to and the hash an archived image
 * is tagged with could silently disagree, and that tag is the only route from a
 * receipt to the image once we are gone.
 */
export const DATA_ROOT = path.join(process.cwd(), ".data");
