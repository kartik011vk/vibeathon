// Append-only request timeline. There is deliberately no update or delete helper.
export function addTimelineEvent(db, { requestId, type, message, actor, isPublic = true, data }) {
  return db.requestTimelineEvent.create({
    data: { requestId, type, message, isPublic, actorId: actor?.id ?? null, data: data ?? undefined },
  });
}

// Recomputes the post-verification request status from allocations, dispatches and delivered quantities.
// Called inside the transaction that changed any of those records.
export async function recomputeRequestStatus(db, requestId) {
  const request = await db.reliefRequest.findUnique({
    where: { id: requestId },
    include: {
      items: true,
      allocations: { select: { status: true } },
      dispatches: { select: { status: true } },
    },
  });
  if (!request || ['SUBMITTED', 'REJECTED', 'CANCELLED'].includes(request.status)) return request;

  const allDelivered = request.items.length > 0 && request.items.every((i) => i.deliveredQuantity >= i.quantity);
  const anyDelivered = request.items.some((i) => i.deliveredQuantity > 0);
  const activeDispatch = request.dispatches.some((d) =>
    ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status),
  );
  const approvedAllocation = request.allocations.some((a) => a.status === 'APPROVED');

  let status;
  // Once anything has arrived, the request stays "partly delivered" until every item is complete;
  // allocation and dispatch progress for the remainder is reported separately by the tracking view.
  if (allDelivered) status = 'DELIVERED';
  else if (anyDelivered) status = 'PARTIALLY_DELIVERED';
  else if (activeDispatch) status = 'DISPATCHED';
  else if (approvedAllocation) status = 'ALLOCATED';
  else status = 'VERIFIED';

  if (status !== request.status) {
    if (status === 'DELIVERED') await db.teamOffer.updateMany({ where: { requestId, status: 'OPEN' }, data: { status: 'DECLINED' } });
    return db.reliefRequest.update({
      where: { id: requestId },
      data: { status, ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}) },
    });
  }
  return request;
}
