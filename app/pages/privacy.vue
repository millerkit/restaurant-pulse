<template>
  <div class="legal">
    <h1>Privacy Policy</h1>
    <p class="meta">Restaurant Pulse &middot; Last updated July 22, 2026</p>

    <p>
      Restaurant Pulse is a private, internal reporting tool
      built for and used by the owners of Urban Hearth. It is not offered to
      the public, and no one outside the restaurant's ownership has access to
      it or the data it displays.
    </p>

    <h2>What data we access</h2>
    <p>
      With your authorization, the application connects to a single
      QuickBooks Online company file via QuickBooks' official API and reads
      Profit &amp; Loss data &mdash; revenue, cost of goods sold, labor, and
      operating expense figures &mdash; for that company. It may also connect
      to the restaurant's point-of-sale system to read supplementary
      operational figures (for example, guest counts) for the same
      reporting purpose.
    </p>
    <p>
      We do not request or access any data beyond what's needed to produce
      this financial reporting: no customer personal information, no payment
      card data, and no data from any QuickBooks company other than the one
      you connect.
    </p>

    <h2>How we use it</h2>
    <p>
      Data is used solely to generate daily, weekly, monthly, and yearly
      financial summaries for the restaurant's own owners to review
      internally. It is never used for advertising, profiling, or any
      purpose other than this internal reporting.
    </p>

    <h2>How we store and protect it</h2>
    <p>
      Data is stored in a private database that only the application's
      operators (the restaurant's owners) can access, behind authentication.
      It is never sold, shared, or disclosed to any third party. QuickBooks
      OAuth credentials are stored securely and used only to refresh access
      to the connected company's data.
    </p>

    <h2>Data retention and deletion</h2>
    <p>
      Data is retained for as long as it's useful for internal reporting.
      Disconnecting the QuickBooks Online connection stops all future
      syncing. To request that stored data be deleted, contact us using the
      information below.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about this policy can be sent to
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
