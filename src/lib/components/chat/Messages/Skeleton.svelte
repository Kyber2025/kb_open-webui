<script lang="ts">
	export let size = 'md';
</script>

<!-- Sized a little larger than the single dot this replaced: three orbiting
     dots need more room to read, and the design is drawn at 22px. The span
     keeps the original layout box so the indicator stays left-aligned in the
     message flow rather than centred like the shared Spinner. -->
<span
	class="relative flex {size === 'md'
		? 'size-5 my-2'
		: size === 'xs'
			? 'size-3.5 my-1'
			: 'size-4 my-1'} mx-1"
>
	<svg aria-hidden="true" class="size-full" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
		<g class="ring">
			<circle class="dot dot-1" cx="17.5" cy="11" r="3" />
			<circle class="dot dot-2" cx="7.75" cy="16.629" r="3" />
			<circle class="dot dot-3" cx="7.75" cy="5.371" r="3" />
		</g>
	</svg>
</span>

<style>
	.ring {
		transform-box: view-box;
		transform-origin: 11px 11px;
		animation: kv-spin 1.8s linear infinite;
	}

	.dot {
		fill: var(--dot);
		transform-box: fill-box;
		transform-origin: center;
		animation: kv-beat 1.25s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
	}

	.dot-1 {
		--dot: #d9cdfd;
	}
	.dot-2 {
		--dot: #9d81f2;
		animation-delay: -0.42s;
	}
	.dot-3 {
		--dot: #6d4de0;
		animation-delay: -0.83s;
	}

	@keyframes kv-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes kv-beat {
		0%,
		100% {
			transform: scale(0.5);
			fill: var(--dot);
		}
		50% {
			transform: scale(1.4);
			fill: #9d81f2;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ring {
			animation: none;
		}
		.dot {
			animation-duration: 2.4s;
		}
	}
</style>
