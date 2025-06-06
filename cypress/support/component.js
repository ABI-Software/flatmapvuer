// ***********************************************************
// This example support/component.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'

// Alternatively you can use CommonJS syntax:
// require('./commands')

import { mount } from 'cypress/vue'
import { addCompareSnapshotCommand } from 'cypress-visual-regression/dist/command';

addCompareSnapshotCommand({
  capture: 'fullPage', // cypress screenshot option
  errorThreshold: 0.5, // plugin threshold option
  pixelmatchOptions: {
    threshold: 0.1 // pixelmatch threshold option
  }
})

Cypress.Commands.add('mount', (...args) => {
  return mount(...args).then(({ wrapper }) => {
    return cy.wrap(wrapper).as('vue')
  })
})


// Example use:
// cy.mount(MyComponent)