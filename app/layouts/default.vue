<template>
  <div class="wrap">
    <nav class="tabnav">
      <NuxtLink to="/" exact-active-class="active">Dashboard</NuxtLink>
      <NuxtLink to="/pl" exact-active-class="active">P&amp;L</NuxtLink>
      <NuxtLink to="/budget" exact-active-class="active">Budget Pace</NuxtLink>
      <NuxtLink to="/budget/edit" exact-active-class="active">Edit Budget</NuxtLink>
    </nav>
    <slot />
    <footer class="app-footer">
      <a href="mailto:kmillercc@gmail.com">Contact / Support</a>
      <NuxtLink to="/privacy">Privacy</NuxtLink>
      <NuxtLink to="/terms">Terms</NuxtLink>
    </footer>
  </div>
</template>
