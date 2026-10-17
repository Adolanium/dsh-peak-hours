/**
 * dsh-peak-hours — Host half.
 *
 * The plugin is a pure presentation concern: the badge computes the current
 * DeepSeek pricing window from the local clock, so it needs no Host service,
 * no route, no persistence, and no network access. This entry exists because
 * every bundle resolves a Loader row; it deliberately does nothing.
 */

/** @param {import('@deepseek-ai/cordis').Context} _ctx */
export function apply(_ctx) {}
