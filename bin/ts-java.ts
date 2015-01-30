/// <reference path='../node_modules/immutable/dist/immutable.d.ts'/>
/// <reference path='../typings/bluebird/bluebird.d.ts' />
/// <reference path='../typings/chalk/chalk.d.ts' />
/// <reference path='../typings/commander/commander.d.ts' />
/// <reference path="../typings/debug/debug.d.ts"/>
/// <reference path='../typings/glob/glob.d.ts' />
/// <reference path='../typings/handlebars/handlebars.d.ts' />
/// <reference path='../typings/lodash/lodash.d.ts' />
/// <reference path='../typings/mkdirp/mkdirp.d.ts' />
/// <reference path='../typings/node/node.d.ts' />
/// <reference path='../lib/jsonfile.d.ts' />

'use strict';

declare function require(name: string);
require('source-map-support').install();

import _ = require('lodash');
import BluePromise = require('bluebird');
import chalk = require('chalk');
import ClassesMap = require('../lib/classes-map');
import CodeWriter = require('../lib/code-writer');
import debug = require('debug');
import fs = require('fs');
import glob = require('glob');
import Immutable = require('immutable');
import java = require('java');
import jsonfile = require('jsonfile');
import mkdirp = require('mkdirp');
import path = require('path');
import program = require('commander');
import Work = require('../lib/work');

import ClassDefinition = ClassesMap.ClassDefinition;
import ClassDefinitionMap = ClassesMap.ClassDefinitionMap;

BluePromise.longStackTraces();
var writeFilePromise = BluePromise.promisify(fs.writeFile);
var readFilePromise = BluePromise.promisify(fs.readFile);
var mkdirpPromise = BluePromise.promisify(mkdirp);
var readJsonPromise = BluePromise.promisify(jsonfile.readFile);

var dlog = debug('ts-java:main');

class Main {

  private granularity: string;

  run(program: any): BluePromise<ClassesMap> {
    this.parseArgs(program);
    this.initJava();
    var classesMap = this.loadClasses();
    return BluePromise.join(this.writeJsons(classesMap.getClasses()), this.writeInterpolatedFiles(classesMap))
      .then(() => dlog('run() completed.'))
      .then(() => classesMap);
  }

  private writeInterpolatedFiles(classesMap: ClassesMap) : BluePromise<any> {
    return this.granularity === 'class' ? this.writeClassFiles(classesMap) : this.writePackageFiles(classesMap);
  }

  private writeJsons(classes: ClassDefinitionMap): BluePromise<any> {
    dlog('writeJsons() entered');
    return mkdirpPromise('o/json')
      .then(() => {
        return _.map(_.keys(classes), (className: string) => {
          var classMap = classes[className];
          return writeFilePromise('o/json/' + classMap.shortName + '.json', JSON.stringify(classMap, null, '  '));
        });
      })
      .then((promises: Promise<any[]>) => BluePromise.all(promises))
      .then(() => dlog('writeJsons() completed.'));
  }

  private writeClassFiles(classesMap: ClassesMap): BluePromise<any> {
    dlog('writeClassFiles() entered');
    return mkdirpPromise('o/lib')
      .then(() => {
        var templatesDirPath = path.resolve(__dirname, '..', 'ts-templates');
        var tsWriter = new CodeWriter(classesMap, templatesDirPath);
        var classes: ClassDefinitionMap = classesMap.getClasses();
        return _.map(_.keys(classes), (name: string) => tsWriter.writeLibraryClassFile(name, this.granularity));
      })
      .then((promises: Promise<any[]>) => BluePromise.all(promises))
      .then(() => dlog('writeClassFiles() completed.'));
  }

  private writePackageFiles(classesMap: ClassesMap): BluePromise<any> {
    dlog('writePackageFiles() entered');
    var templatesDirPath = path.resolve(__dirname, '..', 'ts-templates');
    var tsWriter = new CodeWriter(classesMap, templatesDirPath);
    var classes: ClassDefinitionMap = classesMap.getClasses();
    return tsWriter.writePackageFile()
      .then(() => dlog('writePackageFiles() completed'));
  }

  private initJava(): void {
    var filenames = glob.sync('tinkerpop/target/dependency/**/*.jar');
    _.forEach(filenames, (name: string) => { java.classpath.push(name); });
  }

  private loadClasses(): ClassesMap {
    var seedClasses = [
      'com.tinkerpop.gremlin.structure.Graph',
      'com.tinkerpop.gremlin.tinkergraph.structure.TinkerGraph',
      'com.tinkerpop.gremlin.tinkergraph.structure.TinkerFactory',
      'java.util.ArrayList'
    ];
    var classesMap = new ClassesMap(java, Immutable.Set([
        /^java\.util\./,
        /^java\.math\./,
        /^com\.tinkerpop\.gremlin\./
    ]));
    classesMap.initialize(seedClasses);
    return classesMap;
  }

  private parseArgs(program: any): void {
    var gran = program.granularity;
    if (gran !== 'class' && gran !== 'package') {
      program.help();
    }
    this.granularity = gran;
  }
}

var error = chalk.bold.red;

program.on('--help', () => {
    console.log('--granularity must be either \'class\' or \'package\'');
    console.log('Templates are read from ./ts-templates/*.txt, e.g. ./ts-templates/package.txt');
});

program.usage('[options]')
  .option('-g, --granularity [package]', 'Granularity of output, \'package\' or \'class\'.', 'package')
  .parse(process.argv);

var packageJsonPath = './package.json';
readJsonPromise(packageJsonPath)
  .then((packageContents: any) => {

    if (!('ts-java' in packageContents)) {
      console.error(error('package.json does not contain a ts-java property'));
      program.help();
    }

    var main = new Main();
    return main.run(program)
      .then((classesMap: ClassesMap) => {
        console.log(classesMap.unhandledTypes);
      });
  })
  .catch((err: any) => {
    if (err.cause.code === 'ENOENT' && err.cause.path === packageJsonPath) {
      console.error(error('Not found:', packageJsonPath));
      program.help();
    } else {
      console.error(error(err));
    }
  })
  .done();

