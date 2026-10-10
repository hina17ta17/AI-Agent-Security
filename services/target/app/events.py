"""Publishes WAF detections to Pub/Sub so the AI team is woken up only when needed."""

from __future__ import annotations

import asyncio
import json

from google.cloud import pubsub_v1


class EventPublisher:
    def __init__(self, project_id: str, topic: str):
        self._client = pubsub_v1.PublisherClient(
            batch_settings=pubsub_v1.types.BatchSettings(max_latency=0.005)
        )
        self._topic_path = self._client.topic_path(project_id, topic)

    async def publish(self, event: dict) -> str:
        data = json.dumps(event, ensure_ascii=False).encode("utf-8")
        future = self._client.publish(
            self._topic_path,
            data,
            tenantId=event["tenantId"],
            attackType=event["attackType"],
        )
        # Await before responding: Cloud Run throttles CPU once the response is sent.
        return await asyncio.wait_for(asyncio.wrap_future(future), timeout=10)
