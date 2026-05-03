import type { StreamChunk } from './providers/base';

export function formatSSE(chunk: StreamChunk): string {
	const data = JSON.stringify({
		content: chunk.content.replace(/\n/g, '\\n'),
		model: chunk.model,
		provider: chunk.provider,
		done: chunk.done,
	});
	return `data: ${data}\n\n`;
}

export function createStreamResponse(
	generator: AsyncGenerator<StreamChunk>,
): Response {
	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			try {
				for await (const chunk of generator) {
					const data = formatSSE(chunk);
					controller.enqueue(encoder.encode(data));

					if (chunk.done) {
						break;
					}
				}
			} catch (error) {
				const errorMsg = JSON.stringify({
					error: error instanceof Error ? error.message : 'Streaming error',
				});
				controller.enqueue(encoder.encode(`data: ${errorMsg}\n\n`));
			}

			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
			'X-Accel-Buffering': 'no', // Disable nginx buffering
		},
	});
}
