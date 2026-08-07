<template>
  <div class="wrap">
    <nav class="tabnav">
      <NuxtLink to="/" exact-active-class="active">Dashboard</NuxtLink>
      <NuxtLink to="/pl" exact-active-class="active">P&amp;L</NuxtLink>
      <NuxtLink to="/pl/drilldowns" exact-active-class="active">Drill-Downs</NuxtLink>
      <NuxtLink to="/budget" exact-active-class="active">Budget Pace</NuxtLink>
      <NuxtLink to="/budget/edit" exact-active-class="active">Budget</NuxtLink>
      <NuxtLink to="/cashflow" exact-active-class="active">Cash Flow</NuxtLink>
      <NuxtLink to="/capacity" exact-active-class="active">Capacity Pace</NuxtLink>
      <NuxtLink to="/capacity/edit" exact-active-class="active">Edit Capacity</NuxtLink>
    </nav>
    <slot />
    <footer class="app-footer">
      <a href="mailto:kmillercc@gmail.com">Contact / Support</a>
      <NuxtLink to="/privacy">Privacy</NuxtLink>
      <NuxtLink to="/terms">Terms</NuxtLink>
    </footer>
  </div>
</template>
