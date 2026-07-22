<template>
  <div class="wrap">
    <nav class="tabnav">
      <NuxtLink to="/" exact-active-class="active">Dashboard</NuxtLink>
      <NuxtLink to="/pl" exact-active-class="active">P&amp;L</NuxtLink>
      <NuxtLink to="/budget" exact-active-class="active">Budget</NuxtLink>
    </nav>
    <slot />
  </div>
</template>
