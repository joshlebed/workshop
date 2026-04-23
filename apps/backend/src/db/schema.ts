import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const categoryEnum = pgEnum("rec_category", ["movie", "tv", "book"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  }),
);

export const magicTokens = pgTable("magic_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const recItems = pgTable(
  "rec_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: categoryEnum("category").notNull(),
    count: integer("count").notNull().default(1),
    completed: boolean("completed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    userCategoryTitleIdx: uniqueIndex("rec_items_user_cat_title_idx").on(
      t.userId,
      t.category,
      sql`lower(${t.title})`,
    ),
  }),
);

export type DbUser = typeof users.$inferSelect;
export type DbMagicToken = typeof magicTokens.$inferSelect;
export type DbRecItem = typeof recItems.$inferSelect;
