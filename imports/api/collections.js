import { Mongo } from 'meteor/mongo';

// User settings collection - stores per-user WebDAV configuration
export const UserSettings = new Mongo.Collection('userSettings');

// Client-only collection for file browser items
// Using null means it's not synced to server - purely client-side cache
// Schema: { _id, filename, basename, type, lastmod, parent, loaded }
export const FileItems = new Mongo.Collection(null);
