/**
 * dsh-peak-hours — Host half.
 *
 * The plugin is a pure presentation concern: the badge computes the current
 * DeepSeek pricing window from the local clock, so it needs no Host service,
 * no route, no persistence, and no network access. This entry exists because
 * every bundle resolves a Loader row; it deliberately does nothing else.
 */

export const name = 'dsh-peak-hours'

/** No Host services are required. */
export const inject = []

/** @param {import('@deepseek-ai/cordis').Context} _ctx */
export function apply(_ctx) {}
