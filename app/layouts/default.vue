<script setup lang="ts">
import site from '~/config/site.json'
</script>

<template>
  <div class="wrap">
    <div class="app-header">
      <NuxtLink to="/" class="brand">{{ site.restaurantName }}</NuxtLink>
      <ThemeToggle class="theme-toggle" />
    </div>
    <nav class="tabnav">
      <NuxtLink to="/" exact-active-class="active">Dashboard</NuxtLink>
      <NuxtLink to="/pl" exact-active-class="active">P&amp;L</NuxtLink>
      <NuxtLink to="/pl/revenue-calendar" exact-active-class="active">Revenue/Margin Calendar</NuxtLink>
      <NuxtLink to="/budget" exact-active-class="active">Budget Pace</NuxtLink>
      <NuxtLink to="/budget/edit" exact-active-class="active">Budget</NuxtLink>
      <NuxtLink to="/budget/revenue" exact-active-class="active">Revenue</NuxtLink>
      <NuxtLink to="/budget/labor" exact-active-class="active">Labor</NuxtLink>
      <NuxtLink to="/cashflow" exact-active-class="active">Cash Flow</NuxtLink>
      <NuxtLink to="/capacity" exact-active-class="active">Capacity</NuxtLink>
      <NuxtLink to="/historical" exact-active-class="active">Historical</NuxtLink>
      <NuxtLink to="/revenue-modeling" exact-active-class="active">Revenue Modeling</NuxtLink>
    </nav>
    <slot />
    <footer class="app-footer">
      <a href="mailto:kmillercc@gmail.com">Contact / Support</a>
      <NuxtLink to="/privacy">Privacy</NuxtLink>
      <NuxtLink to="/terms">Terms</NuxtLink>
    </footer>
  </div>
</template>
