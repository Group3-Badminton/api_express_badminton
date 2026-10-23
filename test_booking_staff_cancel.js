require('dotenv').config();

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Booking = require('./src/models/booking');
const User = require('./src/models/user');
const bookingService = require('./src/services/bookingService');

const makeTestUri = (uri, databaseName) => {
  if (!uri) {
    throw new Error('Set MONGODB_URI or BOOKING_TEST_MONGODB_URI to run this isolated database test.');
  }
  const parsedUri = new URL(uri);
  parsedUri.pathname = `/${databaseName}`;
  return parsedUri.toString();
};

const createBooking = (
  bookingCode,
  { status = 'CONFIRMED', items, bookingDate, customerId = new mongoose.Types.ObjectId() } = {}
) =>
  Booking.create({
    customerId,
    courtId: new mongoose.Types.ObjectId(),
    bookingCode,
    bookingDate,
    startTime: '18:00',
    endTime: '19:00',
    price: items.reduce((sum, item) => sum + item.price, 0),
    discount: 30,
    totalAmount: items.reduce((sum, item) => sum + item.price, 0) - 30,
    status,
    items: items.map((item) => ({
      courtId: new mongoose.Types.ObjectId(),
      courtName: item.courtName,
      bookingDate: item.bookingDate || bookingDate,
      startTime: item.startTime || '18:00',
      endTime: item.endTime || '19:00',
      price: item.price,
      status: 'ACTIVE'
    }))
  });

const assertCancellationError = async (promise, statusCode) => {
  await assert.rejects(promise, (error) => error.statusCode === statusCode);
};

const main = async () => {
  const databaseName = `bcmw_staff_cancel_test_${process.pid}_${Date.now()}`;
  const testUri = makeTestUri(
    process.env.BOOKING_TEST_MONGODB_URI || process.env.MONGODB_URI,
    databaseName
  );
  await mongoose.connect(testUri);

  const actor = { role: 'ADMIN', userId: new mongoose.Types.ObjectId() };
  const futureDate = new Date('2099-12-31T00:00:00.000Z');
  const pastDate = new Date('2000-01-01T00:00:00.000Z');

  try {
    const booking = await createBooking('STAFF-CANCEL-MULTI', {
      bookingDate: futureDate,
      items: [
        { courtName: 'Sân A', price: 100 },
        { courtName: 'Sân B', price: 200 },
        { courtName: 'Sân C', price: 300 }
      ]
    });
    const [itemA, itemB, itemC] = booking.items;

    const cancelled = await bookingService.updateBookingStatus(
      booking._id,
      { status: 'CANCELLED', itemIds: [itemA._id.toString(), itemB._id.toString()] },
      actor
    );
    assert.deepEqual(
      cancelled.items.map((item) => item.status),
      ['CANCELLED', 'CANCELLED', 'ACTIVE']
    );
    assert.equal(cancelled.status, 'CONFIRMED');
    assert.equal(cancelled.price, 300);
    assert.equal(cancelled.discount, 30);
    assert.equal(cancelled.totalAmount, 270);
    assert.equal(cancelled.items[2].price, 300);

    await assertCancellationError(
      bookingService.updateBookingStatus(
        booking._id,
        { status: 'CANCELLED', itemIds: [itemA._id.toString()] },
        actor
      ),
      409
    );
    const afterRepeat = await Booking.findById(booking._id).lean();
    assert.equal(afterRepeat.price, 300);
    assert.equal(afterRepeat.items[2].status, 'ACTIVE');

    const lastCancelled = await bookingService.updateBookingStatus(
      booking._id,
      { status: 'CANCELLED', itemIds: [itemC._id.toString()] },
      actor
    );
    assert.deepEqual(lastCancelled.items.map((item) => item.status), ['CANCELLED', 'CANCELLED', 'CANCELLED']);
    assert.equal(lastCancelled.status, 'CANCELLED');
    assert.equal(lastCancelled.price, 0);
    assert.equal(lastCancelled.discount, 0);
    assert.equal(lastCancelled.totalAmount, 0);

    const invalidSelection = await createBooking('STAFF-CANCEL-INVALID-ID', {
      bookingDate: futureDate,
      items: [
        { courtName: 'Sân D', price: 100 },
        { courtName: 'Sân E', price: 200 }
      ]
    });
    const invalidSelectionItemId = invalidSelection.items[0]._id.toString();
    await assertCancellationError(
      bookingService.updateBookingStatus(
        invalidSelection._id,
        {
          status: 'CANCELLED',
          itemIds: [invalidSelectionItemId, new mongoose.Types.ObjectId().toString()]
        },
        actor
      ),
      404
    );
    const unchangedInvalidSelection = await Booking.findById(invalidSelection._id).lean();
    assert.equal(unchangedInvalidSelection.price, 300);
    assert(unchangedInvalidSelection.items.every((item) => item.status === 'ACTIVE'));

    const invalidTimeBooking = await createBooking('STAFF-CANCEL-INVALID-TIME', {
      bookingDate: futureDate,
      items: [
        { courtName: 'Sân F', price: 100, bookingDate: futureDate },
        { courtName: 'Sân G', price: 200, bookingDate: pastDate }
      ]
    });
    const invalidTimeItemIds = invalidTimeBooking.items.map((item) => item._id.toString());
    await assertCancellationError(
      bookingService.updateBookingStatus(
        invalidTimeBooking._id,
        { status: 'CANCELLED', itemIds: invalidTimeItemIds },
        actor
      ),
      409
    );
    const unchangedInvalidTime = await Booking.findById(invalidTimeBooking._id).lean();
    assert.equal(unchangedInvalidTime.price, 300);
    assert(unchangedInvalidTime.items.every((item) => item.status === 'ACTIVE'));

    const directWholeBookingCancel = await createBooking('STAFF-CANCEL-DIRECT-WHOLE', {
      bookingDate: pastDate,
      items: [
        { courtName: 'Sân J', price: 100 },
        { courtName: 'Sân K', price: 200 }
      ]
    });
    await assertCancellationError(
      bookingService.updateBookingStatus(
        directWholeBookingCancel._id,
        { status: 'CANCELLED' },
        actor
      ),
      409
    );
    const unchangedWholeBooking = await Booking.findById(directWholeBookingCancel._id).lean();
    assert.equal(unchangedWholeBooking.status, 'CONFIRMED');
    assert.equal(unchangedWholeBooking.price, 300);
    assert(unchangedWholeBooking.items.every((item) => item.status === 'ACTIVE'));

    const wholeBooking = await createBooking('STAFF-CANCEL-WHOLE-VALID', {
      bookingDate: futureDate,
      items: [
        { courtName: 'Sân L', price: 100 },
        { courtName: 'Sân M', price: 200 }
      ]
    });
    const wholeBookingResult = await bookingService.updateBookingStatus(
      wholeBooking._id,
      { status: 'CANCELLED' },
      actor
    );
    assert.equal(wholeBookingResult.cancellationResult.scope, 'BOOKING');
    assert.equal(wholeBookingResult.status, 'CANCELLED');
    assert.equal(wholeBookingResult.price, 0);
    assert(wholeBookingResult.items.every((item) => item.status === 'CANCELLED'));

    const customer = await User.create({
      password: 'test-only-password-hash',
      fullName: 'Booking cancellation test customer',
      role: 'CUSTOMER',
      status: 'ACTIVE'
    });
    const customerBooking = await createBooking('CUSTOMER-CANCEL-REGRESSION', {
      bookingDate: futureDate,
      customerId: customer._id,
      items: [
        { courtName: 'Sân H', price: 150 },
        { courtName: 'Sân I', price: 250 }
      ]
    });
    const customerResult = await bookingService.updateBookingStatus(
      customerBooking._id,
      { status: 'CANCELLED', itemId: customerBooking.items[0]._id.toString() },
      { role: 'CUSTOMER', userId: customer._id }
    );
    assert.equal(customerResult.status, 'CONFIRMED');
    assert.equal(customerResult.price, 250);
    assert.equal(customerResult.items[0].status, 'CANCELLED');
    assert.equal(customerResult.items[1].status, 'ACTIVE');

    console.log('PASS: staff multi-item cancellation, atomic validation, price snapshots, repeat rejection, and Customer regression');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
