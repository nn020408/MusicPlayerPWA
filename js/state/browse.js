// What the main folder view is showing. Anything may read these; they change
// only through the functions below.

// The browse state: the path of open folders from the library root down (the
// last one is what's on screen) and what that folder lists. Only these
// functions change it, so other features can read it but never reassign it.
export let folderStack = [];

export let currentTracks = [];

export let currentFolders = [];

export function currentFolder() {
  return folderStack[folderStack.length - 1];
}

export function pushFolder(folder) {
  folderStack.push(folder);
}

export function truncateFolderStack(length) {
  folderStack = folderStack.slice(0, length);
}

export function replaceFolderStack(stack) {
  folderStack = stack;
}

export function setListing(tracks, folders) {
  currentTracks = tracks;
  currentFolders = folders;
}