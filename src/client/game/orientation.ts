// Landscape on a phone. Reddit's app keeps a web view upright whatever the phone does, a page can't turn it (the Screen Orientation API is refused there, and a lock
// that did take once left a phone stuck sideways), and Devvit has no setting for it. So landscape is the game's own: a button turns the game a quarter inside the page
// (public/landscape.html runs it in a turned frame), and the player turns the phone to match. It is only ever the player's choice, kept for the visit, and the game
// can ask to leave it. Here: the pure decisions. Nothing imported, so it is unit-tested under Node.

/** The session key that says this visit is in the landscape frame. */
export const LANDSCAPE_KEY = 'mazeHeist.landscape';

/** Whether "turn your phone sideways" shows: a touch screen held upright, not already in the frame, and the card hasn't been put away. */
export function rotateHintWanted(o: { touch: boolean; portrait: boolean; inFrame: boolean; dismissed: boolean }): boolean {
  return o.touch && o.portrait && !o.inFrame && !o.dismissed;
}

/** Whether the game, just loaded, should hand over to the landscape page: it was chosen this visit, on a touch screen, and this is not the frame's own copy. */
export function shouldEnterLandscape(o: { chosen: boolean; touch: boolean; inFrame: boolean }): boolean {
  return o.chosen && o.touch && !o.inFrame;
}

/** The name public/landscape.html gives its frame: a window knows its own name, whatever happens to the address. */
export const LANDSCAPE_FRAME_NAME = 'mazeLandscape';

/**
 * Whether this copy of the game is the one running inside the landscape frame: the frame's name (the sure sign: Reddit's pages may rewrite an address, but not a
 * window's name), or an address saying `inner=1`, and either way with a page above it.
 */
export function inLandscapeFrame(search: string, windowName: string, hasParentPage: boolean): boolean {
  return hasParentPage && (windowName === LANDSCAPE_FRAME_NAME || new URLSearchParams(search).get('inner') === '1');
}
