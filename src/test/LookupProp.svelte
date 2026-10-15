<script lang="ts">
	// test-only component: indexes a lookup by a prop, like fuz_ui's `Alert`
	// does with `status`, so an unexpected value throws during render
	const KINDS: Record<string, { label: string }> = { ok: { label: 'all good' } };

	const { kind = 'ok' }: { kind?: string } = $props();
</script>

<span data-lookup>{KINDS[kind]!.label}</span>
