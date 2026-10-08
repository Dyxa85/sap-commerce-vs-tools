import { createMockHac } from './index.ts';

const port = Number(process.env.PORT ?? 9003);
createMockHac().listen(port, '127.0.0.1', () => {
  console.log(
    `mock hAC listening on http://127.0.0.1:${port}/hac (user: mock-user / pass: mock-pass)`,
  );
});
