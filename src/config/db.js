'use strict';
const knex = require('knex');
const config = require('../../knexfile');

/** Single shared Knex instance (mysql2 connection pool, max 5 connections). */
module.exports = knex(config);
