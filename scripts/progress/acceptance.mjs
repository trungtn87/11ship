// An explicit Owner decision on an evidence PR. CI never supplies this decision.
export function ownerDecision(comments, ownerLogin, task) {
  const records = comments.filter((c) => c.user?.login === ownerLogin).flatMap((c) => {
    const match = String(c.body ?? '').trim().match(/^(OWNER_ACCEPTED|OWNER_REJECTED) ([A-Z0-9-]+) ([a-f0-9]{40})$/);
    return match && match[2] === task ? [{ task, head_sha: match[3], decision: match[1], owner_login: ownerLogin, comment_id: c.id }] : [];
  });
  return records.sort((a, b) => b.comment_id - a.comment_id)[0] ?? null;
}

export function acceptanceValid(record, ownerLogin, task, head) {
  return Boolean(record && record.owner_login === ownerLogin && record.task === task && record.head_sha === head && record.decision === 'OWNER_ACCEPTED' && Number.isInteger(record.comment_id));
}
