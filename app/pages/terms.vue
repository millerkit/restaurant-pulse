<template>
  <div class="legal">
    <h1>End-User License Agreement</h1>
    <p class="meta">Restaurant Pulse &middot; Last updated July 22, 2026</p>

    <p>
      Restaurant Pulse is a private application built and
      operated solely for internal use by the owners of Urban Hearth. It is
      not distributed, licensed, or made available to the public, and access
      is restricted to the restaurant's own ownership.
    </p>

    <h2>Scope of use</h2>
    <p>
      By connecting your QuickBooks Online account, you authorize the
      application to access and display financial data from that single
      connected company for the purpose of internal financial reporting.
      This authorization can be revoked at any time by disconnecting the
      QuickBooks Online connection.
    </p>

    <h2>No warranty</h2>
    <p>
      This application is provided "as is," without warranty of any kind,
      express or implied. It is a reporting tool intended to support, not
      replace, the figures in your QuickBooks Online records, which remain
      the source of truth.
    </p>

    <h2>Changes</h2>
    <p>
      Because this is a private tool built for a single restaurant, these
      terms may be updated as the application evolves. Material changes will
      be reflected on this page.
    </p>

    <h2>Contact</h2>
    <p>
      Questions can be sent to
      <a href="mailto:kmillercc@gmail.com">kmillercc@gmail.com</a>.
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })
</script>

<style scoped>
.legal {
  max-width: 680px;
  margin: 0 auto;
  padding: 48px 20px 80px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
  line-height: 1.6;
}
h1 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0 0 4px;
}
h2 {
  font-size: 15px;
  font-weight: 700;
  margin: 28px 0 8px;
}
.meta {
  font-size: 12px;
  color: var(--ink-3);
  margin: 0 0 28px;
}
p {
  font-size: 14px;
  color: var(--ink-2);
  margin: 0 0 12px;
}
a {
  color: var(--accent);
}
</style>
