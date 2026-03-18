const start = Date.now();

let sum = 0;
for (let i = 0; i < 10000000; i++) {
    sum += i;
}

const end = Date.now();

console.log(`JS Loop sum = ${sum}`);
console.log(`Time: ${(end - start) / 1000} seconds`);
