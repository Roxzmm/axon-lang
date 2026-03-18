import time

start = time.time()

sum_val = 0
for i in range(10000000):
    sum_val += i

end = time.time()

print(f"Python Loop sum = {sum_val}")
print(f"Time: {end - start:.3f} seconds")
