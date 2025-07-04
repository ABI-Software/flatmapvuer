// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add("login", (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add("drag", { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add("dismiss", { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite("visit", (originalFn, url, options) => { ... })

import 'cypress-wait-until';
import CypressComponentWrapper from '../component/CypressComponentWrapper.vue'
import { createPinia, setActivePinia } from 'pinia';

Cypress.on('uncaught:exception', (err) => {
    // returning false here prevents Cypress from
    // failing the test
    if (err.message.includes('Source "markers" already exists.'))
        return false
    if (err.message.includes("this.facets.at is not a function"))
        return false
    if (err.message.includes("Cannot read properties of null (reading '$el')"))
        return false
    return true
})

Cypress.Commands.add('loadMultiFlatmap', (entry, species = undefined) => {
    const readySpy = cy.spy().as('readySpy')
    cy.get(entry).then((props) => {
        console.log('flatmapAPI', props)
        let propsPayload = props
        if (species) {
            propsPayload.initial = species
        }
        cy.mount(CypressComponentWrapper, {
            propsData: {
                component: 'MultiFlatmapVuer',
                props: propsPayload,
                events: {
                    ready: readySpy
                }
            },
            global: {
                plugins: setActivePinia(createPinia())
            }
        }).then((vm) => {
            cy.wrap(vm).as('vm')
            window.vm = vm
        }).get('@vue').should('exist')
            // Now that we have the vue wrapper, check that the ready event is fired
            .then(() => {
                cy.get('@vue').should(wrapper => {
                    expect(wrapper.emitted('ready')).to.be.ok
                    Cypress.multiFlatmapVuerWrapper = wrapper
                })
            })
    })
})