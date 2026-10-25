# Changelog

## 0.1.1

- The badge now appears only when the session's selected model comes from a
  DeepSeek direct route (`deepseek-official` or `deepseek-account`). With any
  other provider selected it renders nothing, because DeepSeek's peak /
  off-peak pricing does not apply to that provider's bill.
- The gate follows the composer's model directory, so it tracks model switches
  and the catalog default on a fresh session, and falls back to the session's
  durable `modelSelection` projection when the catalog cannot be read.

## 0.1.0

First release.

- Composer badge with the current pricing window and a draining ring.
- Detail popover with a second-accurate countdown, a 24-hour local-day face,
  the next switch, the schedule in the viewer's timezone, and Beijing time.
- Peak policy evaluated on the Beijing calendar, including the official 2026
  Chinese public holiday schedule.
- Fallback to Beijing time when the runtime exposes no usable timezone.
- English and Chinese copy; light and dark themes through Harness tokens.
- No dependencies, no build step, no network access.
