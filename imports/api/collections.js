import { Mongo } from 'meteor/mongo';

// User settings collection - stores per-user WebDAV configuration
export const UserSettings = new Mongo.Collection('userSettings');
