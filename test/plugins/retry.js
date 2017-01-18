var path = require('path')
var specHelper = require(path.join(__dirname, '..', '_specHelper.js')).specHelper
var should = require('should') // eslint-disable-line

describe('plugins', function () {
  describe('retry', function () {
    var queue
    var scheduler

    var jobs = {
      'brokenJob': {
        plugins: ['retry'],
        pluginOptions: { retry: {
          retryLimit: 3,
          retryDelay: 100
        } },
        perform: function (a, b, callback) {
          callback(new Error('BUSTED'), null)
        }
      },
      'happyJob': {
        plugins: ['retry'],
        pluginOptions: { retry: {
          retryLimit: 3,
          retryDelay: 100
        } },
        perform: function (a, b, callback) {
          callback(null, null)
        }
      }
    }

    before(function (done) {
      specHelper.connect(function () {
        specHelper.cleanup(function () {
          var Queue = specHelper.NR.queue
          var Scheduler = specHelper.NR.scheduler
          queue = new Queue({connection: specHelper.cleanConnectionDetails(), queue: specHelper.queue}, jobs)
          scheduler = new Scheduler({connection: specHelper.cleanConnectionDetails(), timeout: specHelper.timeout})
          scheduler.connect(function () {
            scheduler.start()
            queue.connect(done)
          })
        })
      })
    })

    after(function (done) {
      scheduler.end(done)
    })

    afterEach(function (done) {
      specHelper.cleanup(done)
    })

    it('will work fine with non-crashing jobs', function (done) {
      queue.enqueue(specHelper.queue, 'happyJob', [1, 2], function () {
        queue.length(specHelper.queue, function (err, length) {
          should.not.exist(err)
          length.should.equal(1)

          var Worker = specHelper.NR.worker
          var worker = new Worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: specHelper.queue
          }, jobs)

          var complete = function () {
            specHelper.redis.llen('resque_test:failed', function (err, length) {
              should.not.exist(err)
              length.should.equal(0)
              worker.end(done)
            })
          }

          worker.connect(function () {
            worker.on('success', function () {
              complete()
            })

            worker.on('failure', function () {
              throw new Error('should never get here')
            })

            worker.start()
          })
        })
      })
    })

    it('will retry the job n times before finally failing', function (done) {
      queue.enqueue(specHelper.queue, 'brokenJob', [1, 2], function () {
        queue.length(specHelper.queue, function (err, length) {
          should.not.exist(err)
          length.should.equal(1)

          var failButRetryCount = 0
          var failureCount = 0

          var Worker = specHelper.NR.worker
          var worker = new Worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: specHelper.queue
          }, jobs)

          var complete = function () {
            failButRetryCount.should.equal(2)
            failureCount.should.equal(1);
            (failButRetryCount + failureCount).should.equal(3)

            specHelper.redis.llen('resque_test:failed', function (err, length) {
              should.not.exist(err)
              length.should.equal(1)
              worker.end(done)
            })
          }

          worker.connect(function () {
            worker.on('success', function () {
              failButRetryCount++
            })

            worker.on('failure', function () {
              failureCount++
              complete()
            })

            worker.start()
          })
        })
      })
    })

    it('can have a retry count set', function (done) {
      this.timeout(1000 * 10)

      var customJobs = {
        'jobWithRetryCount': {
          plugins: ['retry'],
          pluginOptions: { retry: {
            retryLimit: 5,
            retryDelay: 100
          } },
          perform: function (a, b, callback) {
            callback(new Error('BUSTED'), null)
          }
        }
      }

      queue.enqueue(specHelper.queue, 'jobWithRetryCount', [1, 2], function () {
        queue.length(specHelper.queue, function (err, length) {
          should.not.exist(err)
          length.should.equal(1)

          var failButRetryCount = 0
          var failureCount = 0

          var Worker = specHelper.NR.worker
          var worker = new Worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: specHelper.queue
          }, customJobs)

          var complete = function () {
            failButRetryCount.should.equal(4)
            failureCount.should.equal(1);
            (failButRetryCount + failureCount).should.equal(5)

            specHelper.redis.llen('resque_test:failed', function (err, length) {
              should.not.exist(err)
              length.should.equal(1)
              worker.end(done)
            })
          }

          worker.connect(function () {
            worker.on('success', function () {
              failButRetryCount++
            })

            worker.on('failure', function () {
              failureCount++
              complete()
            })

            worker.start()
          })
        })
      })
    })

    it('can have custom retry times set', function (done) {
      this.timeout(1000 * 10)

      var customJobs = {
        'jobWithBackoffStrategy': {
          plugins: ['retry'],
          pluginOptions: { retry: {
            retryLimit: 5,
            backoffStrategy: [1, 2, 3, 4, 5]
          } },
          perform: function (a, b, callback) {
            callback(new Error('BUSTED'), null)
          }
        }
      }

      queue.enqueue(specHelper.queue, 'jobWithBackoffStrategy', [1, 2], function () {
        queue.length(specHelper.queue, function (err, length) {
          should.not.exist(err)
          length.should.equal(1)

          var failButRetryCount = 0
          var failureCount = 0

          var Worker = specHelper.NR.worker
          var worker = new Worker({
            connection: specHelper.cleanConnectionDetails(),
            timeout: specHelper.timeout,
            queues: specHelper.queue
          }, customJobs)

          var complete = function () {
            failButRetryCount.should.equal(4)
            failureCount.should.equal(1);
            (failButRetryCount + failureCount).should.equal(5)

            specHelper.redis.llen('resque_test:failed', function (err, length) {
              should.not.exist(err)
              length.should.equal(1)
              worker.end(done)
            })
          }

          worker.connect(function () {
            worker.on('success', function () {
              failButRetryCount++
            })

            worker.on('failure', function () {
              failureCount++
              complete()
            })

            worker.start()
          })
        })
      })
    })

    it('when a job fails it should be re-enqueued (and not go to the failure queue)', function (done) {
      this.timeout(1000 * 10)

      queue.enqueue(specHelper.queue, 'brokenJob', [1, 2], function () {
        var Worker = specHelper.NR.worker
        var worker = new Worker({
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: specHelper.queue
        }, jobs)

        var complete = function () {
          queue.scheduledAt(specHelper.queue, 'brokenJob', [1, 2], function (err, timestamps) {
            should.not.exist(err)
            timestamps.length.should.be.equal(1)
            specHelper.redis.llen('resque_test:failed', function (err, length) {
              should.not.exist(err)
              length.should.equal(0)
              worker.end(done)
            })
          })
        }

        worker.connect(function () {
          worker.on('success', function () { complete() })
          worker.start()
        })
      })
    })

    it('will handle the stats properly for failing jobs', function (done) {
      this.timeout(1000 * 10)

      queue.enqueue(specHelper.queue, 'brokenJob', [1, 2], function () {
        var Worker = specHelper.NR.worker
        var worker = new Worker({
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: specHelper.queue
        }, jobs)

        var complete = function () {
          specHelper.redis.get('resque_test:stat:processed', function (err, globalProcessed) {
            should.not.exist(err)
            specHelper.redis.get('resque_test:stat:failed', function (err, globalFailed) {
              should.not.exist(err)
              specHelper.redis.get('resque_test:stat:processed:' + worker.name, function (err, workerProcessed) {
                should.not.exist(err)
                specHelper.redis.get('resque_test:stat:failed:' + worker.name, function (err, workerFailed) {
                  should.not.exist(err)
                  String(globalProcessed).should.equal('0')
                  String(globalFailed).should.equal('1')
                  String(workerProcessed).should.equal('0')
                  String(workerFailed).should.equal('1')
                  worker.end(done)
                })
              })
            })
          })
        }

        worker.connect(function () {
          worker.on('success', function () { complete() })
          worker.start()
        })
      })
    })

    it('will set the retry counter & retry data', function (done) {
      this.timeout(1000 * 10)

      queue.enqueue(specHelper.queue, 'brokenJob', [1, 2], function () {
        var Worker = specHelper.NR.worker
        var worker = new Worker({
          connection: specHelper.cleanConnectionDetails(),
          timeout: specHelper.timeout,
          queues: specHelper.queue
        }, jobs)

        var complete = function () {
          specHelper.redis.get('resque_test:resque-retry:brokenJob:1-2', function (err, retryAttempts) {
            should.not.exist(err)
            specHelper.redis.get('resque_test:failure-resque-retry:brokenJob:1-2', function (err, failureData) {
              should.not.exist(err)
              String(retryAttempts).should.equal('0')
              failureData = JSON.parse(failureData)
              failureData.payload.should.deepEqual([1, 2])
              failureData.exception.should.equal('Error: BUSTED')
              failureData.worker.should.equal('brokenJob')
              failureData.queue.should.equal('test_queue')
              worker.end(done)
            })
          })
        }

        worker.connect(function () {
          worker.on('success', function () { complete() })
          worker.start()
        })
      })
    })
  })
})
