# Reading and accepting findings

Every check errata runs reports a finding the same way: what is wrong, where it is, and what the repair is. This page covers what to do with one.


Every check must come out clean. If you cannot fix a finding now, record it in `.errata.yaml`. This file is at the root of the **content** repository, not in errata.

Each entry names one finding:

- which check found it
- which instance the entry covers
- why you did not fix it
- the date of the decision

An entry without a reason fails. Errata accepts nothing without a reason.

Each entry also stores a fingerprint. The fingerprint is a hash of the code block. If somebody edits the block, errata opens the finding again. An entry therefore cannot excuse content that nobody has read since.

Errata reports three states. All three fail:

| State | Meaning | What to do |
|---|---|---|
| open | No entry covers this finding. | Fix the content, or add an entry. |
| stale | The block changed after you wrote the entry. | Read the finding again. Update or delete the entry. |
| renamed | The lesson was retitled, so the entry's key no longer points at it. | Update the key. Errata prints the new one. |
| resolved | The entry covers no finding. | Delete the entry. |

Keep `renamed` and `resolved` apart when you act on them. Retitling a lesson changes its slug, which silently detaches every entry against it, and deleting those entries throws away decisions that still hold.

The file also has a `notes` section. Use it for an observation that no check looks for. A note suppresses nothing and fails nothing. It survives for the next person who edits the lesson.

One check keeps a numeric limit instead: `driftBudget.staleImageRefs`. A pinned digest gets one day older every day, but the block itself never changes, so a fingerprint cannot expire the entry.
