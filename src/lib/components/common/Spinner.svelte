<script lang="ts">
	export let className: string = 'size-4';
</script>

<div class="flex justify-center text-center">
	<!-- Geometry is expressed in the 22x22 viewBox the design was drawn at, so
	     every size-* a caller passes keeps the ratios: dot 0.27x the box, orbit
	     radius 0.30x. 6.5 + 3 x 1.4 = 10.7 <= 11, so the peak never paints
	     outside the element's own box at any size. -->
	<svg aria-hidden="true" class={className} viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
		<!-- Rotation belongs to the ring, scale to the dots. Both on one element
		     would mean one transform silently overwriting the other. -->
		<g class="ring">
			<circle class="dot dot-1" cx="17.5" cy="11" r="3" />
			<circle class="dot dot-2" cx="7.75" cy="16.629" r="3" />
			<circle class="dot dot-3" cx="7.75" cy="5.371" r="3" />
		</g>
	</svg>
</div>

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
		/* Overshooting curve: each dot springs past its peak and settles. The
		   spring is what stops it reading as mechanical. */
		animation: kv-beat 1.25s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
	}

	/* Thirds of the pulse period, so the three never peak together. */
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

	/* Colour rides the same keyframe as the scale rather than a second
	   animation, which would let the two drift apart. At full size every dot is
	   the primary purple, so the primary follows the peak around the ring. */
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
